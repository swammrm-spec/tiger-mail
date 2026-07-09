\set ON_ERROR_STOP on

-- Run this file with psql while connected to the default `postgres` database.
-- Example:
--   psql -U postgres -d postgres -f deployment/create-database.sql

\set db_name engineering_archive
\set db_user engineering_archive_app
\set db_password CHANGE_ME_STRONG_PASSWORD

SELECT format(
  'CREATE ROLE %I LOGIN PASSWORD %L',
  :'db_user',
  :'db_password'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'db_user'
)\gexec

SELECT format(
  'CREATE DATABASE %I OWNER %I ENCODING %L TEMPLATE template0',
  :'db_name',
  :'db_user',
  'UTF8'
)
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_database
  WHERE datname = :'db_name'
)\gexec

SELECT format(
  'GRANT ALL PRIVILEGES ON DATABASE %I TO %I',
  :'db_name',
  :'db_user'
)\gexec
