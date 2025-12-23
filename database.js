import mongoose from 'mongoose';

// MongoDB connection
export async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/email_manager');
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

// Email Account Schema
const emailAccountSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    appPassword: {
        type: String,
        required: true
    },
    sentCount: {
        type: Number,
        default: 0
    },
    maxSendLimit: {
        type: Number,
        default: 500
    },
    isRateLimited: {
        type: Boolean,
        default: false
    },
    rateLimitedAt: Date,
    lastUsedAt: Date,
    status: {
        type: String,
        enum: ['active', 'rate-limited', 'disabled'],
        default: 'active'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Sent Email Log Schema
const sentEmailSchema = new mongoose.Schema({
    fromAccount: {
        type: String,
        required: true,
        lowercase: true
    },
    toEmail: {
        type: String,
        required: true,
        lowercase: true
    },
    subject: String,
    sentAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['success', 'failed'],
        default: 'success'
    },
    errorMessage: String,
    messageId: String,
    csvFile: String
});

// Add indexes (email already has unique index from schema)
emailAccountSchema.index({ status: 1, sentCount: 1 });
sentEmailSchema.index({ fromAccount: 1, sentAt: -1 });
sentEmailSchema.index({ toEmail: 1 });

export const EmailAccount = mongoose.model('EmailAccount', emailAccountSchema);
export const SentEmail = mongoose.model('SentEmail', sentEmailSchema);

// Helper functions
export async function getAvailableAccount() {
    // Find an account that's active, not rate limited, and under the limit
    const account = await EmailAccount.findOne({
        status: 'active',
        isRateLimited: false,
        $expr: { $lt: ['$sentCount', '$maxSendLimit'] }
    }).sort({ sentCount: 1 }); // Get account with least emails sent

    return account;
}

export async function incrementSentCount(email) {
    await EmailAccount.findOneAndUpdate(
        { email: email.toLowerCase() },
        { 
            $inc: { sentCount: 1 },
            lastUsedAt: new Date()
        }
    );
}

export async function markAccountRateLimited(email) {
    await EmailAccount.findOneAndUpdate(
        { email: email.toLowerCase() },
        { 
            isRateLimited: true,
            rateLimitedAt: new Date(),
            status: 'rate-limited'
        }
    );
    console.log(`Account ${email} marked as rate-limited`);
}

export async function logSentEmail(fromAccount, toEmail, subject, status, messageId = null, errorMessage = null, csvFile = null) {
    await SentEmail.create({
        fromAccount: fromAccount.toLowerCase(),
        toEmail: toEmail.toLowerCase(),
        subject,
        status,
        messageId,
        errorMessage,
        csvFile
    });
}

export async function addOrUpdateAccount(email, appPassword, maxSendLimit = 500) {
    const account = await EmailAccount.findOneAndUpdate(
        { email: email.toLowerCase() },
        { 
            email: email.toLowerCase(),
            appPassword,
            maxSendLimit,
            status: 'active',
            isRateLimited: false
        },
        { upsert: true, new: true }
    );
    return account;
}

export async function getAccountStats(email) {
    const account = await EmailAccount.findOne({ email: email.toLowerCase() });
    if (!account) return null;

    const sentEmails = await SentEmail.countDocuments({ 
        fromAccount: email.toLowerCase(),
        status: 'success'
    });

    return {
        email: account.email,
        sentCount: account.sentCount,
        maxSendLimit: account.maxSendLimit,
        remaining: account.maxSendLimit - account.sentCount,
        isRateLimited: account.isRateLimited,
        status: account.status,
        lastUsedAt: account.lastUsedAt,
        totalLogged: sentEmails
    };
}

export async function getAllAccountsStats() {
    const accounts = await EmailAccount.find().sort({ sentCount: 1 });
    const stats = await Promise.all(
        accounts.map(account => getAccountStats(account.email))
    );
    return stats;
}

export async function resetAccountLimits() {
    await EmailAccount.updateMany(
        {},
        { 
            sentCount: 0,
            isRateLimited: false,
            status: 'active'
        }
    );
    console.log('All account limits reset');
}

export async function wasEmailSent(toEmail, csvFile = null) {
    const query = { 
        toEmail: toEmail.toLowerCase(),
        status: 'success'
    };
    
    if (csvFile) {
        query.csvFile = csvFile;
    }
    
    const sentEmail = await SentEmail.findOne(query);
    return !!sentEmail;
}
