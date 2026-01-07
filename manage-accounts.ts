import {
    connectDB,
    addOrUpdateAccount,
    getAllAccountsStats,
    resetAccountLimits,
    getAccountCredentials,
    updateAccountMaxLimit
} from './database';
import readline from 'readline';
import nodemailer from 'nodemailer';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function addAccount(): Promise<void> {
    console.log('\n=== Add Email Account ===\n');
    
    const email = (await question('Enter email address: ')).trim();
    const appPassword = (await question('Enter app password: ')).trim();
    const maxSendLimit = (await question('Enter max send limit (default 500): ')).trim();
    
    const limit = maxSendLimit ? parseInt(maxSendLimit, 10) : 500;
    
    await addOrUpdateAccount(email, appPassword, limit);
    console.log(`\nAccount added: ${email}`);
}

async function viewAccounts(): Promise<void> {
    console.log('\n=== Email Accounts ===\n');
    const stats = await getAllAccountsStats();
    
    if (!stats || stats.length === 0) {
        console.log('No accounts found.');
        return;
    }
    
    stats.forEach((stat, i) => {
        if (!stat) return;
        console.log(`${i + 1}. ${stat.email}`);
        console.log(`   Status: ${stat.status}`);
        console.log(`   Sent: ${stat.sentCount}/${stat.maxSendLimit}`);
        console.log(`   Remaining: ${stat.remaining}`);
        console.log(`   Rate Limited: ${stat.isRateLimited ? 'Yes' : 'No'}`);
        if (stat.lastUsedAt) {
            console.log(`   Last Used: ${new Date(stat.lastUsedAt).toLocaleString()}`);
        }
        console.log('');
    });
}

async function resetLimits(): Promise<void> {
    console.log('\nThis will reset all account limits and rate limits.\n');
    const confirm = (await question('Are you sure? (yes/no): ')).toLowerCase();
    
    if (confirm === 'yes' || confirm === 'y') {
        await resetAccountLimits();
        console.log('All limits reset successfully!');
    } else {
        console.log('Cancelled.');
    }
}

async function updateAllMaxLimits(): Promise<void> {
    console.log('\n=== Update All Max Limits ===\n');
    
    const stats = await getAllAccountsStats();
    
    if (!stats || stats.length === 0) {
        console.log('No accounts found.');
        return;
    }
    
    console.log(`Current accounts (${stats.length} total):\n`);
    stats.forEach((stat, i) => {
        if (!stat) return;
        console.log(`${i + 1}. ${stat.email} - Current max limit: ${stat.maxSendLimit}`);
    });
    
    const newLimit = await question('\nEnter new max limit for all accounts: ');
    const limit = parseInt(newLimit, 10);
    
    if (isNaN(limit) || limit <= 0) {
        console.log('Invalid limit. Please enter a positive number.');
        return;
    }
    
    const confirm = (await question(`\nThis will update all ${stats.length} accounts to ${limit}. Continue? (yes/no): `)).toLowerCase();
    
    if (confirm === 'yes' || confirm === 'y') {
        for (const stat of stats) {
            if (!stat) continue;
            await updateAccountMaxLimit(stat.email, limit);
        }
        console.log(`\nAll ${stats.length} accounts updated to max limit: ${limit}`);
    } else {
        console.log('Cancelled.');
    }
}

async function testAllAccounts(): Promise<void> {
    console.log('\n=== Testing All App Passwords ===\n');
    
    const stats = await getAllAccountsStats();
    
    if (!stats || stats.length === 0) {
        console.log('No accounts found.');
        return;
    }
    
    console.log(`Testing ${stats.length} account(s)...\n`);
    
    for (let i = 0; i < stats.length; i++) {
        const stat = stats[i];
        if (!stat) continue;
        
        const accountData = await getAccountCredentials(stat.email);
        
        if (!accountData || !accountData.appPassword) {
            console.log(`${i + 1}. ${stat.email}: ❌ Account credentials not found`);
            continue;
        }
        
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: accountData.email,
                    pass: accountData.appPassword
                }
            });
            
            await transporter.verify();
            console.log(`${i + 1}. ${stat.email}: ✓ Valid`);
            transporter.close();
            
        } catch (error: any) {
            console.log(`${i + 1}. ${stat.email}: ❌ Invalid (${error?.message || 'Unknown error'})`);
        }
    }
    
    console.log('\nTesting complete!\n');
}

async function main(): Promise<void> {
    await connectDB();
    
    console.log('\nEmail Account Manager\n');
    console.log('1. Add email account');
    console.log('2. View all accounts');
    console.log('3. Reset all limits');
    console.log('4. Update all max limits');
    console.log('5. Test all app passwords');
    console.log('6. Exit\n');
    
    const choice = await question('Choose an option: ');
    
    switch (choice) {
        case '1':
            await addAccount();
            break;
        case '2':
            await viewAccounts();
            break;
        case '3':
            await resetLimits();
            break;
        case '4':
            await updateAllMaxLimits();
            break;
        case '5':
            await testAllAccounts();
            break;
        case '6':
            console.log('Goodbye!');
            rl.close();
            process.exit(0);
        default:
            console.log('Invalid option');
    }
    
    rl.close();
    process.exit(0);
}

main();
