# Janky Ahh Mailer

Advanced bulk email sender with MongoDB tracking, automatic account rotation, rate limit detection, and CSV progress tracking.

## Features

- **Multi-Account Support**: Rotate through multiple email accounts automatically
- **Rate Limit Detection**: Automatically switches accounts when rate limited
- **MongoDB Integration**: Tracks all sent emails and account statistics
- **CSV Progress Tracking**: Marks emails as sent in CSV files (resumes where you left off)
- **Smart Account Management**: Each account limited to 500 emails (configurable)
- **Automatic Retries**: Retries with a different account if one gets rate limited
- **Single CSV Processing**: Process one CSV file at a time (specify file path as argument)

## Prerequisites

- [Bun](https://bun.sh) installed
- MongoDB running locally (default: `mongodb://localhost:27017/email-mailer`)
- Gmail accounts with App Passwords enabled

### Setting up Gmail App Passwords

1. Go to your Google Account: https://myaccount.google.com/
2. Security → 2-Step Verification (must be enabled)
3. Scroll down to "App passwords"
4. Generate a new app password for "Mail"
5. Copy the 16-character password (no spaces)

## Installation

1. **Clone or navigate to the project directory**

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Start MongoDB** (if not already running)
   ```bash
   # On Windows with MongoDB installed:
   mongod
   
   # On macOS/Linux:
   sudo systemctl start mongod
   # or
   brew services start mongodb-community
   ```

## Initial Setup

### Step 1: Add Email Accounts

Run the account manager to add your email accounts:

```bash
bun manage-accounts.ts
```

Choose option `1` to add an account, then enter:
- Email address (e.g., `yourname@vitstudent.ac.in`)
- App password (16-character password from Gmail)
- Max send limit (default: 500)

Add multiple accounts for better throughput and redundancy.

Example:
```
Enter email address: john.doe2023@vitstudent.ac.in
Enter app password: abcd efgh ijkl mnop
Enter max send limit (default 500): 500
```

### Step 2: View Account Status

To check your accounts:

```bash
bun manage-accounts.ts
```

Choose option `2` to view all accounts and their status.

### Step 3: Prepare Your CSV File

Your CSV file must have a column named **'E-mail 1 - Value'** containing the email addresses.

Example CSV:
```csv
E-mail 1 - Value
student1@example.com
student2@example.com
student3@example.com
```

The script will automatically add a `sent` column to track progress. Process one CSV file at a time.

### Step 4: Prepare HTML Template

Make sure you have an HTML email template at `./interact_mail_csi.html` (or update the path in `mailer.ts`).

## Usage

### Sending Emails

Send emails from a CSV file:

```bash
bun mailer.ts <csv-file-path>
```

Example:
```bash
bun mailer.ts ./test.csv
bun mailer.ts ./ccs-2025-1.csv
bun mailer.ts ./students-batch-2.csv
```

### What Happens:

1. **Database Connection**: Connects to MongoDB
2. **Account Display**: Shows all available accounts and their status
3. **CSV Loading**: Loads CSV and checks which emails were already sent
4. **Confirmation**: Asks for confirmation before sending
5. **Smart Sending**:
   - Uses the account with the least emails sent
   - Automatically switches accounts when one reaches 500 emails
   - Detects rate limiting and switches to another account
   - Updates CSV file every 10 emails sent
   - Marks each email as "sent" in the CSV
6. **Progress Tracking**: You can stop and restart - it won't resend emails

### Resuming After Interruption

If the script stops (rate limit, network issue, etc.), just run it again:

```bash
bun mailer.ts ./your-file.csv
```

It will skip emails already marked as `sent` in the CSV.

## Configuration

Edit `mailer.ts` to customize:

```javascript
const EMAIL_SETTINGS = {
    from: 'CSI Team <{email}>', // {email} is replaced with current sender
    subject: 'Your Email Subject',
    templatePath: './your-template.html',
    delayBetweenBatches: 1000 // Delay in milliseconds
};
```

## Database Schema

### Email Accounts Collection
```javascript
{
    email: String,
    appPassword: String,
    sentCount: Number,        // How many emails sent
    maxSendLimit: Number,     // Maximum allowed (default: 500)
    isRateLimited: Boolean,   // Currently rate limited?
    status: String,           // 'active', 'rate-limited', 'disabled'
    lastUsedAt: Date
}
```

### Sent Emails Log Collection
```javascript
{
    fromAccount: String,      // Which account sent it
    toEmail: String,          // Recipient
    subject: String,
    status: String,           // 'success' or 'failed'
    sentAt: Date,
    errorMessage: String,
    csvFile: String          // Which CSV file
}
```

## Monitoring & Management

### View Account Statistics

```bash
bun manage-accounts.ts
```
Choose option 2.

### Reset All Limits

If you want to reset all accounts (clears sent counts and rate limits):

```bash
bun manage-accounts.ts
```
Choose option 3.

**Warning**: This resets sent counts but does NOT remove logs from the database or "sent" status from CSV files.

## Troubleshooting

### "Too many login attempts" Error

**Solution**: The script automatically detects this and switches to another account. If all accounts are rate-limited:
1. Wait a few hours
2. Add more email accounts
3. Run the reset command (option 3 in manage-accounts.ts)

### MongoDB Connection Error

**Solution**: Make sure MongoDB is running:
```bash
# Check if MongoDB is running
mongod --version

# Start MongoDB
mongod
```

### CSV Not Updating

**Solution**: 
- Check file permissions
- Make sure the CSV file exists and is not open in Excel
- The script updates every 10 emails and at the end

### Email Not Sending

**Solution**:
1. Verify app password is correct
2. Enable "Less secure app access" (if using old Gmail)
3. Make sure 2FA is enabled for app passwords
4. Check internet connection

## File Structure

```
node-mailer/
├── mailer.ts              # Main email sending script
├── database.ts            # MongoDB schemas and helpers
├── manage-accounts.ts     # Account management utility
├── interact_mail_csi.html # Email template
├── test.csv               # Sample CSV file
├── ccs-2025-1.csv         # Your CSV files
└── README.md              # This file
```

## Best Practices

1. **Test First**: Test with a small CSV file (5-10 emails) first
2. **Multiple Accounts**: Use 3-5 email accounts for better throughput
3. **Monitor Logs**: Watch the console output for errors
4. **Backup CSV**: Keep a backup of your original CSV before running
5. **Rate Limits**: Gmail typically allows ~100-500 emails per day per account
6. **Timing**: Spread campaigns across multiple days if you have many emails

## Environment Variables

You can optionally use environment variables:

```bash
export MONGODB_URI="mongodb://localhost:27017/email-mailer"
```

Or create a `.env` file (not included in this setup but can be added).

## Example Workflow

```bash
# 1. Start MongoDB
mongod

# 2. Add email accounts (in a new terminal)
bun manage-accounts.ts
# Choose option 1, add 3-5 accounts

# 3. Check accounts
bun manage-accounts.ts
# Choose option 2

# 4. Send emails from first CSV
bun mailer.ts ./ccs-2025-1.csv
# Review → Type 'yes' → Wait for completion

# 5. Send emails from second CSV
bun mailer.ts ./ccs-3.csv
# Review → Type 'yes' → Wait for completion

# 6. If interrupted, just run again
bun mailer.ts ./ccs-3.csv
# It will skip already-sent emails
```

## Important Notes

- **Serial Processing**: Process one CSV file at a time (as requested)
- **CSV Updates**: CSV files get updated with "sent" column
- **No Duplicates**: Won't resend to emails already marked as sent
- **Account Rotation**: Automatically rotates when limit reached
- **Rate Limit Handling**: Auto-switches on "Too many login attempts"
- **Progress Saved**: Safe to stop and restart anytime

## License

This is a custom tool. Use responsibly and comply with email sending regulations (CAN-SPAM, GDPR, etc.).

## Support

Check the console output for detailed error messages and progress updates.
