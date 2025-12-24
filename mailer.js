import nodemailer from 'nodemailer';
import fs from 'fs';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify';
import readline from 'readline';
import {
    connectDB,
    EmailAccount,
    getAvailableAccount,
    getAllAvailableAccounts,
    incrementSentCount,
    markAccountRateLimited,
    logSentEmail,
    getAllAccountsStats,
    wasEmailSent
} from './database.js';

// Email settings
const EMAIL_SETTINGS = {
    from: 'CSI Team <{email}>', // {email} will be replaced with current account email
    subject: 'Last few hours left! Attempt CSI Interaction 1 Now!',
    templatePath: './interact_mail_csi.html',
    batchSize: 5,
    delayBetweenBatches: 500, // 1 second delay
    minRotationCount: 80, // Minimum emails before rotating account
    maxRotationCount: 120 // Maximum emails before rotating account
};

class EnhancedCSVMailer {
    constructor() {
        this.currentTransporter = null;
        this.currentAccount = null;
        this.emailTemplate = '';
        this.recipients = [];
        this.csvFilePath = '';
        this.csvFileName = '';
        this.sessionEmailCount = 0; // Emails sent with current account in this session
        this.rotationThreshold = 0; // When to rotate to next account
        this.usedAccountIds = new Set(); // Track which accounts we've used
    }

    // Create transporter for a specific account
    createTransporter(account) {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: account.email,
                pass: account.appPassword
            },
            pool: true,
            maxConnections: 5,
            maxMessages: 100
        });
    }

    // Get next available account (prioritize unused accounts for fair distribution)
    async getNextAccount(forceRotation = false) {
        // Get all available accounts
        const allAccounts = await getAllAvailableAccounts();
        
        if (allAccounts.length === 0) {
            console.log('\nNo available email accounts found!');
            console.log('All accounts are either rate-limited or have reached their sending limit.');
            return null;
        }

        let account = null;

        // Try to find an unused account first for fair distribution
        const unusedAccounts = allAccounts.filter(acc => !this.usedAccountIds.has(acc._id.toString()));
        
        if (unusedAccounts.length > 0) {
            // Pick the unused account with lowest sent count
            account = unusedAccounts[0];
            console.log(`\nSelecting unused account: ${account.email}`);
        } else if (allAccounts.length > 1 && forceRotation) {
            // All accounts used at least once, pick different from current if possible
            const otherAccounts = allAccounts.filter(acc => 
                !this.currentAccount || acc._id.toString() !== this.currentAccount._id.toString()
            );
            account = otherAccounts.length > 0 ? otherAccounts[0] : allAccounts[0];
            console.log(`\nRotating to different account: ${account.email}`);
        } else {
            // Just pick the best available
            account = allAccounts[0];
        }

        // Close previous transporter if exists
        if (this.currentTransporter) {
            this.currentTransporter.close();
            console.log('Connection pool closed for previous account');
        }

        this.currentAccount = account;
        this.currentTransporter = this.createTransporter(account);
        this.usedAccountIds.add(account._id.toString());
        
        // Reset session counter and set new rotation threshold
        this.sessionEmailCount = 0;
        this.rotationThreshold = Math.floor(
            Math.random() * (EMAIL_SETTINGS.maxRotationCount - EMAIL_SETTINGS.minRotationCount + 1)
        ) + EMAIL_SETTINGS.minRotationCount;

        console.log(`Switched to account: ${account.email}`);
        console.log(`   Sent: ${account.sentCount}/${account.maxSendLimit}`);
        console.log(`   Will rotate after ~${this.rotationThreshold} emails in this session`);

        return account;
    }

    // Check if error indicates rate limiting
    isRateLimitError(errorMessage) {
        const rateLimitPatterns = [
            'Too many login attempts',
            'rate limit',
            '454',
            '421',
            'temporarily blocked',
            'try again later'
        ];

        return rateLimitPatterns.some(pattern => 
            errorMessage.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    // Load CSV with existing sent status
    async loadCSV(csvFilePath) {
        this.csvFilePath = csvFilePath;
        this.csvFileName = csvFilePath.split(/[/\\]/).pop();

        return new Promise((resolve, reject) => {
            const recipients = [];

            const parser = parse({
                bom: true,
                columns: true,
                skip_empty_lines: true,
                trim: true,
                relax_column_count: true,
                relax_quotes: true
            });

            parser.on('data', (row) => {
                // Get email from 'E-mail 1 - Value' column
                const email = row['E-mail 1 - Value'];
                
                if (email && email.includes('@')) {
                    recipients.push({
                        email: email.trim(),
                        sent: row.sent === 'true' || row.sent === '1' || row.sent === 'yes',
                        originalRow: row
                    });
                }
            });

            parser.on('end', () => {
                this.recipients = recipients;
                const alreadySent = recipients.filter(r => r.sent).length;
                const pending = recipients.length - alreadySent;
                
                console.log(`\nLoaded ${recipients.length} recipients from ${this.csvFileName}`);
                console.log(`   Already sent: ${alreadySent}`);
                console.log(`   Pending: ${pending}`);
                
                resolve(recipients);
            });

            parser.on('error', (error) => {
                console.error('Error reading CSV:', error);
                reject(error);
            });

            fs.createReadStream(csvFilePath).pipe(parser);
        });
    }

    // Update CSV file with sent status
    async updateCSV() {
        return new Promise((resolve, reject) => {
            // Prepare data with sent column
            const records = this.recipients.map(recipient => {
                const row = { ...recipient.originalRow };
                row.sent = recipient.sent ? 'yes' : 'no';
                return row;
            });

            stringify(records, {
                header: true,
                quoted: true
            }, (err, output) => {
                if (err) {
                    reject(err);
                    return;
                }

                fs.writeFile(this.csvFilePath, output, (writeErr) => {
                    if (writeErr) {
                        reject(writeErr);
                        return;
                    }
                    console.log(`\nCSV file updated: ${this.csvFileName}`);
                    resolve();
                });
            });
        });
    }

    // Load HTML template
    async loadTemplate() {
        try {
            this.emailTemplate = fs.readFileSync(EMAIL_SETTINGS.templatePath, 'utf8');
            console.log('Email template loaded');
        } catch (error) {
            console.error('Error loading template:', error);
            throw error;
        }
    }

    // Send email to a single recipient
    async sendEmail(recipient) {
        // Check if account has hit its max limit (critical check) - BEFORE sending
        if (!this.currentAccount || 
            this.currentAccount.sentCount >= this.currentAccount.maxSendLimit) {
            console.log(`\n⚠️  Account limit reached (${this.currentAccount?.sentCount}/${this.currentAccount?.maxSendLimit}). Switching account...`);
            const newAccount = await this.getNextAccount(true);
            if (!newAccount) {
                return { success: false, error: 'No available accounts', needsSwitch: false };
            }
        }

        try {
            const mailOptions = {
                from: EMAIL_SETTINGS.from.replace('{email}', this.currentAccount.email),
                to: recipient.email,
                subject: EMAIL_SETTINGS.subject,
                html: this.emailTemplate
            };

            const info = await this.currentTransporter.sendMail(mailOptions);
            
            // Update local account sent count FIRST (before database)
            this.currentAccount.sentCount++;
            this.sessionEmailCount++;
            
            // Then log to database
            await incrementSentCount(this.currentAccount.email);
            await logSentEmail(
                this.currentAccount.email,
                recipient.email,
                EMAIL_SETTINGS.subject,
                'success',
                info.messageId,
                null,
                this.csvFileName
            );

            console.log(`Sent to ${recipient.email} via ${this.currentAccount.email} (${this.currentAccount.sentCount}/${this.currentAccount.maxSendLimit})`);
            
            return { success: true, messageId: info.messageId };
            
        } catch (error) {
            console.error(`Failed to send to ${recipient.email}: ${error.message}`);
            
            // Check if it's a rate limit error
            if (this.isRateLimitError(error.message)) {
                await markAccountRateLimited(this.currentAccount.email);
                
                // Try to switch to next account
                const newAccount = await this.getNextAccount();
                if (newAccount) {
                    // Retry with new account
                    return await this.sendEmail(recipient);
                } else {
                    return { success: false, error: error.message, needsSwitch: false };
                }
            }
            
            // Log failure
            await logSentEmail(
                this.currentAccount.email,
                recipient.email,
                EMAIL_SETTINGS.subject,
                'failed',
                null,
                error.message,
                this.csvFileName
            );

            return { success: false, error: error.message, needsSwitch: false };
        }
    }

    // Send emails to all recipients
    async sendBulkEmails() {
        // Filter only unsent emails
        const unsentRecipients = this.recipients.filter(r => !r.sent);
        
        if (unsentRecipients.length === 0) {
            console.log('\nAll emails have already been sent!');
            return { sent: 0, failed: 0, skipped: this.recipients.length, errors: [] };
        }

        console.log(`\nStarting to send ${unsentRecipients.length} emails in batches of ${EMAIL_SETTINGS.batchSize}...`);
        
        const results = {
            sent: 0,
            failed: 0,
            skipped: this.recipients.filter(r => r.sent).length,
            errors: []
        };

        // Get initial account
        const initialAccount = await this.getNextAccount();
        if (!initialAccount) {
            console.log('Cannot start - no available accounts');
            return results;
        }

        // Process emails in batches
        const totalBatches = Math.ceil(unsentRecipients.length / EMAIL_SETTINGS.batchSize);
        
        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIdx = batchIndex * EMAIL_SETTINGS.batchSize;
            const endIdx = Math.min(startIdx + EMAIL_SETTINGS.batchSize, unsentRecipients.length);
            const batch = unsentRecipients.slice(startIdx, endIdx);
            
            console.log(`\nBatch ${batchIndex + 1}/${totalBatches} (${batch.length} emails)`);
            
            // Send all emails in batch concurrently
            const batchPromises = batch.map(async (recipient, index) => {
                const overallIndex = startIdx + index + 1;
                const progress = `[${overallIndex}/${unsentRecipients.length}]`;
                
                console.log(`${progress} Processing ${recipient.email}...`);
                
                const result = await this.sendEmail(recipient);
                
                if (result.success) {
                    recipient.sent = true;
                    return { success: true, recipient };
                } else {
                    return { 
                        success: false, 
                        recipient, 
                        error: result.error 
                    };
                }
            });
            
            // Wait for all emails in batch to complete
            const batchResults = await Promise.all(batchPromises);
            
            // Process results
            batchResults.forEach(result => {
                if (result.success) {
                    results.sent++;
                } else {
                    results.failed++;
                    results.errors.push({
                        recipient: result.recipient.email,
                        error: result.error
                    });
                }
            });
            
            // Update CSV after each batch
            await this.updateCSV();
            console.log(`Batch ${batchIndex + 1} complete: ${batchResults.filter(r => r.success).length}/${batch.length} sent`);
            
            // Check if we should rotate account for fair distribution (only between batches)
            if (batchIndex < totalBatches - 1) {
                if (this.sessionEmailCount >= this.rotationThreshold) {
                    console.log(`\n🔄 Rotation threshold (${this.rotationThreshold}) reached. Switching to next account for fair distribution...`);
                    const newAccount = await this.getNextAccount(true);
                    if (!newAccount) {
                        console.log('⚠️  No other accounts available, continuing with current account');
                    } else {
                        console.log('✓ Account rotated successfully');
                    }
                }
                
                // Delay between batches
                console.log(`Waiting ${EMAIL_SETTINGS.delayBetweenBatches}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, EMAIL_SETTINGS.delayBetweenBatches));
            }
        }

        // Final CSV update
        await this.updateCSV();

        return results;
    }

    // Display summary
    displaySummary() {
        console.log('\n' + '='.repeat(60));
        console.log('EMAIL SUMMARY');
        console.log('='.repeat(60));
        console.log(`CSV File: ${this.csvFileName}`);
        console.log(`Total recipients: ${this.recipients.length}`);
        console.log(`Already sent: ${this.recipients.filter(r => r.sent).length}`);
        console.log(`Pending: ${this.recipients.filter(r => !r.sent).length}`);
        console.log(`Subject: ${EMAIL_SETTINGS.subject}`);
        console.log('='.repeat(60));
    }

    // Get user confirmation
    async getUserConfirmation() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('\nProceed with sending emails? (yes/no): ', (answer) => {
                rl.close();
                resolve(answer.toLowerCase().trim() === 'yes' || answer.toLowerCase().trim() === 'y');
            });
        });
    }

    // Main execution
    async run(csvFilePath) {
        try {
            console.log('\nEnhanced CSV Mailer Starting...\n');

            // Connect to database
            await connectDB();

            // Show account stats
            const stats = await getAllAccountsStats();
            console.log('\nEmail Accounts Status:');
            console.log('='.repeat(60));
            stats.forEach((stat, i) => {
                console.log(`${i + 1}. ${stat.email}`);
                console.log(`   Status: ${stat.status} | Sent: ${stat.sentCount}/${stat.maxSendLimit} | Remaining: ${stat.remaining}`);
            });
            console.log('='.repeat(60));

            // Load template and CSV
            await this.loadTemplate();
            await this.loadCSV(csvFilePath);

            if (this.recipients.length === 0) {
                console.log('\nNo valid recipients found in CSV file');
                return;
            }

            // Display summary
            this.displaySummary();

            // Get confirmation
            const confirmed = await this.getUserConfirmation();
            if (!confirmed) {
                console.log('\nCancelled by user');
                return;
            }

            // Send emails
            const results = await this.sendBulkEmails();
            
            console.log('\n' + '='.repeat(60));
            console.log('EMAIL SENDING COMPLETED');
            console.log('='.repeat(60));
            console.log(`Successfully sent: ${results.sent}`);
            console.log(`Failed: ${results.failed}`);
            console.log(`Skipped (already sent): ${results.skipped}`);
            
            if (results.sent > 0) {
                const successRate = Math.round((results.sent / (results.sent + results.failed)) * 100);
                console.log(`Success rate: ${successRate}%`);
            }
            
            if (results.errors.length > 0 && results.errors.length <= 10) {
                console.log('\nFailed emails:');
                results.errors.forEach((error, index) => {
                    console.log(`   ${index + 1}. ${error.recipient}: ${error.error}`);
                });
            }

            console.log('\nCampaign completed!');
            console.log(`CSV file has been updated with sent status\n`);

            // Close transporter
            if (this.currentTransporter) {
                this.currentTransporter.close();
            }

        } catch (error) {
            console.error('\nFatal error:', error);
            if (this.currentTransporter) {
                this.currentTransporter.close();
            }
        }
    }
}

// Command line interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('\nError: No CSV file specified');
        console.log('\nUsage: bun mailer.js <csv-file-path>');
        console.log('Example: bun mailer.js ./test.csv\n');
        process.exit(1);
    }

    const csvFilePath = args[0];
    
    if (!fs.existsSync(csvFilePath)) {
        console.log(`\nError: CSV file not found: ${csvFilePath}\n`);
        process.exit(1);
    }

    const mailer = new EnhancedCSVMailer();
    await mailer.run(csvFilePath);
    
    process.exit(0);
}

// Run the mailer
main();
