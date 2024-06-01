import 'dotenv/config';
import fetch from 'node-fetch';

export const triggerCloudRun = async (event, context) => {
    const url = process.env.GOOGLE_CLOUD_RUN_URL; // Replace with your Cloud Run service URL
    await fetch(url, { method: 'GET' });
};
