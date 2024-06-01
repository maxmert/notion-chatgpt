# Use the official Node.js image
FROM node:14

ENV PORT 3000

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy application dependency manifests to the container image.
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy local code to the container image.
COPY . .

EXPOSE 8080

# Specify the entrypoint script
ENTRYPOINT ["node", "index.js"]
