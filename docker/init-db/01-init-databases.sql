-- ReviewLens Local PostgreSQL Database Initialization
-- Creates reviewlens_test alongside the default reviewlens_dev database
SELECT 'CREATE DATABASE reviewlens_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'reviewlens_test')\gexec
GRANT ALL PRIVILEGES ON DATABASE reviewlens_test TO reviewlens;

