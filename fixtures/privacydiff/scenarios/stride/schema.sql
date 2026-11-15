CREATE TABLE accounts (id BIGINT PRIMARY KEY, full_name VARCHAR, email VARCHAR NOT NULL, password_hash VARCHAR, age_range VARCHAR, gender VARCHAR, signup_source VARCHAR, created_at TIMESTAMP);
CREATE TABLE workouts (workout_id BIGINT, user_id BIGINT, gps_lat DOUBLE, gps_lng DOUBLE, avg_heart_rate INTEGER, started_at TIMESTAMP);
CREATE TABLE devices (device_id VARCHAR, ip_address VARCHAR, os_version VARCHAR, push_token VARCHAR);
CREATE TABLE profile (user_id BIGINT, date_of_birth DATE, phone_number VARCHAR, home_address VARCHAR);
