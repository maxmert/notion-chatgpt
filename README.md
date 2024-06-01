**Important**. This code is 💩, I wrote it in 1 hour and didn't think about resilience, maintainability or handling edge cases. It's a proof of concept and should not be used in production. 

## Task
When I share any internet article with Notion, I:
- (this functionality provided by Notion) Get the Notion Page, with article URL (should be a separate property of the Notion Database), title, and (in some cases) description
- I want the service to check the Notion Database every 10 minutes and fetch all Pages
- If the Page not updated (a tag "updated" not attached), I want the service to update the Page with the new content:
  - (if text do not exist) scrape the URL (again, this property should be added to Notion Database just once) and get the summary from ChatGPT and attach it to the Page
  - create the audio file from the summary using ChatGPT
  - attach the audio file to the Page
  - add the tag "updated" to the Page
 

Essentially, you will need to deploy your service to Cloud Run and then set up a Cloud Scheduler job to trigger the service at your desired interval (every 10 minutes in this case). Here's a step-by-step guide on how to achieve this, with a dash of wit to keep things lively.
## Local
Create `.env` file with the following content:

```sh
NOTION_API_TOKEN="secret_xxxxxxxxxxxxx"
NOTION_DATABASE_ID="xxxxxxxxxxxxx"
OPENAI_API_KEY="sk-proj-xxxxxxxxxxxxx"
OPENAI_ORGANIZATION_ID="org-xxxxxxxxxxxxx"
OPENAI_PROJECT_ID="proj_xxxxxxxxxxxxx"
GOOGLE_PROJECT_ID="xxxxxxxxxxxxx"
```

Uncomment the following line in `index.js`:
```js
// main();
```

Run the following command:
```sh
yarn start
```


## Deploy to GCP

### Step 1: Build and push the docker image to GCR
You need to have Docker and gcloud CLI installed on your machine. First, build and push the Docker image to Google Container Registry (GCR).

```sh
yarn docker:build
yarn docker:push
```

### Step 2: Deploy to Google Cloud Run
Deploy the Docker image to Google Cloud Run.
```sh
yarn deploy
```

### Step 3: Set Up Cloud Scheduler

Now, you need to set up Cloud Scheduler to trigger your Cloud Run service every 10 minutes. This step involves creating a Pub/Sub topic and a Cloud Scheduler job.

1. **Create a Pub/Sub topic:**

    ```sh
    gcloud pubsub topics create NOTION_LINKS_CHECK
    ```

2. **Create a Cloud Scheduler job:**

    ```sh
    gcloud scheduler jobs create pubsub notion-links \
      --schedule "*/10 * * * *" \
      --topic NOTION_LINKS_CHECK \
      --message-body '{}' \
      --time-zone "YOUR_TIME_ZONE"
    ```

   Replace `YOUR_TIME_ZONE` with your desired time zone.


3. **Deploy the Cloud Function:**
Go to the folder `trigger-cloud-run-function` and run the following command:
   ```sh
   yarn deploy
   ```

### Summary

Congratulations! You've just set up a Node.js service to run every 10 minutes on Google Cloud Run, with Cloud Scheduler and Pub/Sub doing the heavy lifting. Now you can sit back and enjoy a nice cup of tea, knowing your service is ticking away like a well-oiled clock.
