import {
    connectDB,
    addOrUpdateAccount,
    getAllAccountsStats,
    resetAccountLimits
} from './database.js';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function addAccount() {
    console.log('\n=== Add Email Account ===\n');
    
    const email = await question('Enter email address: ');
    const appPassword = await question('Enter app password: ');
    const maxSendLimit = await question('Enter max send limit (default 500): ');
    
    const limit = maxSendLimit ? parseInt(maxSendLimit) : 500;
    
    await addOrUpdateAccount(email, appPassword, limit);
    console.log(`\nAccount added: ${email}`);
}

async function viewAccounts() {
    console.log('\n=== Email Accounts ===\n');
    const stats = await getAllAccountsStats();
    
    if (stats.length === 0) {
        console.log('No accounts found.');
        return;
    }
    
    stats.forEach((stat, i) => {
        console.log(`${i + 1}. ${stat.email}`);
        console.log(`   Status: ${stat.status}`);
        console.log(`   Sent: ${stat.sentCount}/${stat.maxSendLimit}`);
        console.log(`   Remaining: ${stat.remaining}`);
        console.log(`   Rate Limited: ${stat.isRateLimited ? 'Yes' : 'No'}`);
        if (stat.lastUsedAt) {
            console.log(`   Last Used: ${stat.lastUsedAt.toLocaleString()}`);
        }
        console.log('');
    });
}

async function resetLimits() {
    console.log('\nThis will reset all account limits and rate limits.\n');
    const confirm = await question('Are you sure? (yes/no): ');
    
    if (confirm.toLowerCase() === 'yes' || confirm.toLowerCase() === 'y') {
        await resetAccountLimits();
        console.log('All limits reset successfully!');
    } else {
        console.log('Cancelled.');
    }
}

async function main() {
    await connectDB();
    
    console.log('\nEmail Account Manager\n');
    console.log('1. Add email account');
    console.log('2. View all accounts');
    console.log('3. Reset all limits');
    console.log('4. Exit\n');
    
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
