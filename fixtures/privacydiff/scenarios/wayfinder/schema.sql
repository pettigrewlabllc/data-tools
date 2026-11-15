CREATE TABLE users (user_id BIGINT, email VARCHAR, full_name VARCHAR, ip_address VARCHAR, religious_affiliation VARCHAR, ethnicity VARCHAR, preferred_language VARCHAR);
CREATE TABLE trips (trip_id BIGINT, user_id BIGINT, start_lat DOUBLE, start_lon DOUBLE, end_lat DOUBLE, end_lon DOUBLE, started_at TIMESTAMP);
CREATE TABLE page_views (view_id BIGINT, user_id BIGINT, page_path VARCHAR, search_history VARCHAR, referrer VARCHAR);
