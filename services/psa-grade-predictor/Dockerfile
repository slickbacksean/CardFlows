FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY serve.py .

ENV PSA_GRADE_HOST=0.0.0.0
ENV PSA_GRADE_PORT=8091
EXPOSE 8091

CMD ["python", "serve.py"]
