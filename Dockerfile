FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PORT=7860 \
    TAVERN_SAVE_DIR=/app/storage/saves \
    TAVERN_CONFIG=/app/storage/config.json

WORKDIR /app
COPY . .
RUN mkdir -p /app/storage/saves && chmod -R 777 /app/storage

EXPOSE 7860
CMD ["python", "server.py", "--host", "0.0.0.0"]
