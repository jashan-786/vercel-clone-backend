import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { exec } from 'child_process';
import fs from 'fs';
import simpleGit from 'simple-git';
import cors from 'cors';
import { getType } from 'mime'; 
import { uploadDir } from './upload'; 

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json()); 

function getRandomId() {
    const length = 8;
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }
    return result;
}

async function runCmd(command: string) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(stderr);
            }
            else {
                resolve(stdout);
            }
        });
    });
}

async function buildWithDocker(clonePath: string, repoName: string) {
    const dockerFile = `
        FROM node:16
        WORKDIR /app
        COPY package*.json ./
        RUN npm install
        COPY . .
        RUN npm run build
    `;
    
    fs.writeFileSync(`${clonePath}/Dockerfile`, dockerFile);
    
    // Build the Docker image
    await runCmd(`sudo docker build -t ${repoName} ${clonePath}`);
    console.log('Docker build completed successfully');

    await runCmd(`sudo docker create --name ${repoName}_container ${repoName}`)
    console.log(`Container created from image: ${repoName}`);

    const localDistPath = path.join(clonePath, 'dist');
    await runCmd(`sudo docker cp ${repoName}_container:/app/dist ${localDistPath}`);

    await runCmd(`sudo docker rm ${repoName}_container`);
    console.log(`Removed container: ${repoName}_container`);
}

app.post('/deploy', async (req, res) => {
    const gitUrl = req.body.url;
    console.log(gitUrl)
    const repoName = `${getRandomId()}`; // just to give unique name for Docker image
    console.log(__dirname)
    const clonePath = path.join(__dirname, `output/${repoName}`);
    console.log(clonePath)
    
    try {
        const outputPath = path.join(__dirname, 'output');
        if (!fs.existsSync(outputPath)) {
            fs.mkdirSync(outputPath, { recursive: true });
            console.log(`Created output directory at: ${outputPath}`);
        }

        // Step 1: Clone the repo
        console.log(`Cloning repository to ${clonePath}...`);
        await simpleGit().clone(gitUrl, clonePath).catch((err) => {
            console.error('Git clone failed:', err);
            throw new Error('Git clone operation failed');
        });;
        
        // Step 2: Build the project using Docker
        console.log('Running Docker build');
        await buildWithDocker(clonePath, repoName);
        

        const buildPath = path.join(clonePath, 'dist');

        if (!fs.existsSync(buildPath)) {
            throw new Error(`Build failed ${buildPath} folder not found`);
        }

        console.log(`Build artifacts found in: ${buildPath}`);

        // // Step 3: Upload to S3
        const s3BucketName = process.env.S3_BUCKET || '';
        await uploadDir(`${clonePath}/dist`, repoName,s3BucketName);
        
        const siteUrl = `https://${repoName}.deployer.tallentgallery.online/`;
        console.log(siteUrl)
        res.json({ siteUrl });
    } 
    catch (error) {
        console.error('Deployment failed:', error);
        res.status(500).json({ msg: 'Deployment failed' });
    } 
    finally {
        try{
            fs.rmSync(clonePath, { recursive: true, force: true });
        }
        catch(error){
            console.log("Attempting to remove it using sudo.")
            await runCmd(`sudo rm -rf ${clonePath}`);
        }
    }

    // removing the docker images
    try {
        await runCmd(`sudo docker rmi ${repoName}`);
        console.log(`Docker image ${repoName} deleted successfully`);
    } 
    catch (err) {
        console.error(`Failed to delete Docker image ${repoName}:`, err);
        
    }
});

app.listen(3000, () => {
    console.log('running on 3000');
});
