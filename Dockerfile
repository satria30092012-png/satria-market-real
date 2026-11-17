FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
# Port default 3000 (ubah lewat env PORT; di Hugging Face Spaces pakai 7860)
ENV PORT=3000 NODE_ENV=production TZ=Asia/Jakarta
EXPOSE 3000
CMD ["node", "server.js"]
