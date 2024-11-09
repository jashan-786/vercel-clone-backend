import { promises as fs, createReadStream } from 'fs';
import * as path from 'path';
import { S3, PutObjectCommand } from '@aws-sdk/client-s3'; 
import mime from 'mime'; // Import the mime package
import dotenv from 'dotenv';

dotenv.config();

// Initialize the S3 client
const s3 = new S3({
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    },
    region: process.env.AWS_REGION || '',
});

// Upload directory to S3 under the `repoName` folder
export async function uploadDir(s3Path: string, repoName: string, bucketName: string) {
    // Helper function to recursively get all files in the directory
    async function getFiles(dir: string): Promise<string[]> {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(
            dirents.map((dirent) => {
                const res = path.resolve(dir, dirent.name);
                return dirent.isDirectory() ? getFiles(res) : res;
            })
        );
        return Array.prototype.concat(...files);
    }

    const files = await getFiles(s3Path);

    const uploads = files.map(async (filePath) => {
        // Create the S3 key by prefixing with repoName
        const relativePath = path.relative(s3Path, filePath);
        const s3Key = `${repoName}/${relativePath}`; // Add repoName to the path

        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: s3Key, 
            Body: createReadStream(filePath),
            ContentType: getContentType(filePath), // used mime here , to determint the types
        });

        await s3.send(command);
        console.log(`Uploaded ${filePath} to s3://${bucketName}/${s3Key}`);
    });

    await Promise.all(uploads);
    console.log(`Successfully uploaded all files to s3://${bucketName}/${repoName}`);
}

// this is gonna tell the type of the file that is being pushed to s3 
function getContentType(filename: string): string {
    return mime.getType(filename) || 'application/octet-stream';
}
