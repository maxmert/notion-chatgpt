require('dotenv').config()
const axios = require('axios');
const cheerio = require('cheerio');
const wrapper = require('axios-cookiejar-support').wrapper;
const CookieJar = require('tough-cookie').CookieJar;
const OpenAI = require("openai");
const { PassThrough } = require('stream');
const { Storage } = require('@google-cloud/storage');
const { get } = require('lodash');

const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

const jar = new CookieJar();
const client = wrapper(axios.create({ jar, headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36'
    }, withCredentials: true }));

const openai = new OpenAI({
    organization: process.env.OPENAI_ORGANIZATION_ID,
    project: process.env.OPENAI_PROJECT_ID,
    apiKey: process.env.OPENAI_API_KEY,
});

const notionHeaders = {
    'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
};

const storage = new Storage({
    keyFilename: 'notion-IAM-admin.json',
    projectId: process.env.GOOGLE_PROJECT_ID,
});
const bucketName = 'notion-news-audio'; // replace with your bucket name

async function uploadToGCS(audioStream, gcsFileName) {
    console.info(`Uploading file to GCS: ${gcsFileName}`);
    // Create a writable stream for the file in the bucket
    const writeStream = storage.bucket(bucketName).file(gcsFileName).createWriteStream();

    // Pipe the audio stream to the writable stream
    audioStream.pipe(writeStream);

    // Listen for the finish event to know when the file has been fully uploaded
    await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
    });

    const file = storage.bucket(bucketName).file(gcsFileName);

    // Make the file public
    await file.makePublic();

    // Construct and return the public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsFileName}`;
    return publicUrl;
}

async function getNewPages() {
    console.info('Fetching new pages');
    const url = `https://api.notion.com/v1/databases/${process.env.NOTION_DATABASE_ID}/query`;
    const response = await axios.post(url, {}, { headers: notionHeaders });
    const data = response.data;
    return data.results.filter(page => page.object === 'page');
}

async function scrapePage(url) {
    const response = await client.get(url);
    const $ = cheerio.load(response.data);
    return $('article').text();
}

async function generateAudio(text) {
    console.info(`Generating audio for text`);
    // Ensure the text does not exceed 4096 characters
    let trimmedText = text;
    if (text.length > 4096) {
        trimmedText = text.substring(0, 4096);
    }

    const mp3 = await openai.audio.speech.create({
        model: "tts-1",
        voice: "onyx",
        input: trimmedText,
    });

    // Create a stream from the response
    const audioStream = new PassThrough();
    audioStream.end(Buffer.from(await mp3.arrayBuffer()));

    return audioStream;
}

async function processNewPage(page) {
    console.info('Processing new page', page.id);
    const tags = page.properties.Tags.multi_select;
    if (tags.some(tag => tag.name === 'updated')) {
        console.info('Page has already been updated, ignoring', page.id);
        // If the page has been updated, ignore it
        return;
    }

    // Assuming the URL is stored in a property called 'URL'
    const pageId = page.id;
    // Get the page details
    const pageDetailsUrl = `https://api.notion.com/v1/blocks/${page.id}/children`;
    const pageDetailsResponse = await axios.get(pageDetailsUrl, { headers: notionHeaders });
    const pageDetails = pageDetailsResponse.data;

    // The main text of the page is in the 'content' property of the first block
    let mainText = pageDetails.results.reduce((text, block) => {
        if (block.type === 'paragraph') {
            return text + get(block, 'paragraph.rich_text[0].plain_text', '');
        }
        return text;
    }, '');


    // Create a text if there is no text on the Page
    if (!mainText) {
        const pageUrl = page.properties.URL.url;
        const scrapedText = await scrapePage(pageUrl);

        const response = await openai.chat.completions.create({
            messages: [{ role: "system", content: `Make a summary with the limit the character number to maximum 3000 characters:\n\n${scrapedText}` }],
            model: "gpt-4o",
            max_tokens: 2000,
        });

        mainText = response.choices[0].message.content;
        await updateNotionText(pageId, mainText);
    }

    const audioStream = await generateAudio(mainText);
    const audioUrl = await uploadToGCS(audioStream, `${pageId}.mp3`);

    await updateNotionPage(pageId, audioUrl);
}

// Function to split text into chunks
function splitTextIntoChunks(text, chunkSize) {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
}

// Function to create rich_text objects from text chunks
function createRichTextFromChunks(chunks) {
    return chunks.map(chunk => ({
        type: 'text',
        text: {
            content: chunk
        }
    }));
}

async function updateNotionText(pageId, text) {
    // Split the text into chunks of 2000 characters
    const textChunks = splitTextIntoChunks(text, 2000);

    // Create rich_text objects from the text chunks
    const richText = createRichTextFromChunks(textChunks);

    console.info(`Updating Notion page ${pageId} with text`);
    // Update the main text of the page
    const blockUpdateUrl = `https://api.notion.com/v1/blocks/${pageId}/children`;
    const blockUpdateData = {
        children: [
            {
                object: 'block',
                type: 'paragraph',
                paragraph: {
                    rich_text: richText
                }
            }
        ]
    };

    return axios.patch(blockUpdateUrl, blockUpdateData, { headers: notionHeaders });
}

async function updateNotionPage(pageId, audioUrl, text) {
    // if (text.length > 2000) {
    //     text = text.substring(0, 2000);
    // }
    console.info(`Updating Notion page ${pageId} with audio URL ${audioUrl}`);
    const updateUrl = `https://api.notion.com/v1/pages/${pageId}`;
    const updateData = {
        properties: {
            Audio: {
                type: 'files',
                files: [
                    {
                        name: 'Audio',
                        external: {
                            url: audioUrl
                        }
                    }
                ]
            },
            Tags: { // Assuming 'Tags' is the name of your tag property in Notion
                type: 'multi_select',
                multi_select: [{ name: 'updated' }]
            }
        }
    };

    return axios.patch(updateUrl, updateData, { headers: notionHeaders });
}

// This function is used only for local testing purposes
async function main() {
    const newPages = await getNewPages();
    for (const page of newPages) {
        await processNewPage(page);
    }
}
// main();

app.get('/', async (req, res) => {
    const newPages = await getNewPages();
    for (const page of newPages) {
        await processNewPage(page);
    }
    res.send('Process completed');
});

app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`)
});

