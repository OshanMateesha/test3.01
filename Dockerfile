FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# WebKit Browser එක පමණක් install කර ගැනීම
RUN npx playwright install webkit

EXPOSE 7860

CMD ["node", "index.js"]
