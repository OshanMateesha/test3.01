FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./

# 🔴 RUN npm ci වෙනුවට 🟢 RUN npm install යොදන්න:
RUN npm install

COPY . .

RUN npx playwright install webkit

EXPOSE 7860

CMD ["node", "index.js"]
