FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Dependencies සහ WebKit ස්ථාපනය
RUN npx playwright install-deps webkit
RUN npx playwright install webkit

EXPOSE 7860

CMD ["node", "index.js"]
