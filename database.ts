import mongoose from 'mongoose';

export async function connectDB(): Promise<void> {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/email_manager');
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        throw error;
    }
}

type AccountStatus = 'active' | 'rate-limited' | 'disabled';

export interface IEmailAccount {
    email: string;
    appPassword: string;
    sentCount: number;
    maxSendLimit: number;
    isRateLimited: boolean;
    rateLimitedAt?: Date;
    lastUsedAt?: Date;
    status: AccountStatus;
    createdAt: Date;
}

export interface ISentEmail {
    fromAccount: string;
    toEmail: string;
    subject?: string;
    sentAt: Date;
    status: 'success' | 'failed';
    errorMessage?: string;
    messageId?: string;
    csvFile?: string;
}

const emailAccountSchema = new mongoose.Schema<IEmailAccount>({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    appPassword: { type: String, required: true },
    sentCount: { type: Number, default: 0 },
    maxSendLimit: { type: Number, default: 500 },
    isRateLimited: { type: Boolean, default: false },
    rateLimitedAt: Date,
    lastUsedAt: Date,
    status: { type: String, enum: ['active', 'rate-limited', 'disabled'], default: 'active' },
    createdAt: { type: Date, default: Date.now }
});

const sentEmailSchema = new mongoose.Schema<ISentEmail>({
    fromAccount: { type: String, required: true, lowercase: true },
    toEmail: { type: String, required: true, lowercase: true },
    subject: String,
    sentAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    errorMessage: String,
    messageId: String,
    csvFile: String
});

emailAccountSchema.index({ status: 1, sentCount: 1 });
sentEmailSchema.index({ fromAccount: 1, sentAt: -1 });
sentEmailSchema.index({ toEmail: 1 });

export const EmailAccount = mongoose.model<IEmailAccount>('EmailAccount', emailAccountSchema);
export const SentEmail = mongoose.model<ISentEmail>('SentEmail', sentEmailSchema);

export async function getAvailableAccount() {
    const account = await EmailAccount.findOne({
        status: 'active',
        isRateLimited: false,
        $expr: { $lt: ['$sentCount', '$maxSendLimit'] }
    }).sort({ sentCount: 1 });

    return account;
}

export async function getAllAvailableAccounts() {
    const accounts = await EmailAccount.find({
        status: 'active',
        isRateLimited: false,
        $expr: { $lt: ['$sentCount', '$maxSendLimit'] }
    }).sort({ sentCount: 1 });

    return accounts;
}

export async function incrementSentCount(email: string): Promise<void> {
    await EmailAccount.findOneAndUpdate(
        { email: email.toLowerCase() },
        { 
            $inc: { sentCount: 1 },
            lastUsedAt: new Date()
        }
    );
}

export async function markAccountRateLimited(email: string): Promise<void> {
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

export async function logSentEmail(
    fromAccount: string,
    toEmail: string,
    subject: string,
    status: 'success' | 'failed',
    messageId = '',
    errorMessage = '',
    csvFile = ''
): Promise<void> {
    await SentEmail.create({
        fromAccount: fromAccount.toLowerCase(),
        toEmail: toEmail.toLowerCase(),
        subject,
        status,
        messageId: messageId || '',
        errorMessage: errorMessage || '',
        csvFile: csvFile || ''
    });
}

export async function addOrUpdateAccount(email: string, appPassword: string, maxSendLimit = 500) {
    const updateData: Partial<IEmailAccount> & { email: string; maxSendLimit: number; status: AccountStatus; isRateLimited: boolean } = { 
        email: email.toLowerCase(),
        maxSendLimit,
        status: 'active',
        isRateLimited: false
    };
    
    if (appPassword && appPassword.trim() !== '') {
        updateData.appPassword = appPassword;
    }
    
    const account = await EmailAccount.findOneAndUpdate(
        { email: email.toLowerCase() },
        updateData,
        { upsert: true, new: true }
    );
    return account;
}

export async function updateAccountMaxLimit(email: string, maxSendLimit: number) {
    const account = await EmailAccount.findOneAndUpdate(
        { email: email.toLowerCase() },
        { 
            maxSendLimit,
            status: 'active',
            isRateLimited: false
        },
        { new: true }
    );
    return account;
}

export async function getAccountStats(email: string) {
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

export async function getAccountCredentials(email: string) {
    const account = await EmailAccount.findOne({ email: email.toLowerCase() });
    if (!account) return null;
    
    return {
        email: account.email,
        appPassword: (account as any).appPassword
    };
}

export async function resetAccountLimits(): Promise<void> {
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

export async function wasEmailSent(toEmail: string, csvFile: string | null = null): Promise<boolean> {
    const query: Record<string, unknown> = { 
        toEmail: toEmail.toLowerCase(),
        status: 'success'
    };
    
    if (csvFile) {
        (query as any).csvFile = csvFile;
    }
    
    const sentEmail = await SentEmail.findOne(query);
    return !!sentEmail;
}
