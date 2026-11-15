CREATE TABLE families (family_id BIGINT, parent_email VARCHAR, created_at TIMESTAMP);
CREATE TABLE learners (learner_id BIGINT, family_id BIGINT, child_first_name VARCHAR, child_dob DATE, is_under_13 BOOLEAN, school_name VARCHAR, grade_level INTEGER);
CREATE TABLE sessions (session_id VARCHAR, learner_id BIGINT, device_id VARCHAR, cookie_id VARCHAR, ip_address VARCHAR, minutes INTEGER);
