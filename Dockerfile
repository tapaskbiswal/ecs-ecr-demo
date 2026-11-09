FROM node:20-alpine
WORKDIR /app
COPY --chown=node:node app.js ./
USER node
EXPOSE 3000
CMD ["node", "app.js"]
