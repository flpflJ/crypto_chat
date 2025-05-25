FROM python:3.13-slim
RUN pip install uvicorn fastapi
WORKDIR /app
COPY main.py .
EXPOSE 8000/tcp
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]