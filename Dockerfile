FROM node:18-alpine

# Install aria2
RUN apk add --no-cache aria2

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy source code
COPY index.js ./

# Define volume for downloads
VOLUME /downloads

# Run the app
CMD [ "npm", "start" ]
