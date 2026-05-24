FROM python:3.12-slim

WORKDIR /app

COPY auth/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install -r requirements.txt

# Copy shared db package + auth source
COPY db ./db
COPY auth ./auth

EXPOSE 8001

CMD ["uvicorn", "auth.src.main:app", "--host", "0.0.0.0", "--port", "8001"]
