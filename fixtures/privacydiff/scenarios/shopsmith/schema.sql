CREATE TABLE customers (customer_id BIGINT, first_name VARCHAR, last_name VARCHAR, email VARCHAR, phone VARCHAR, birthdate DATE, gender VARCHAR, loyalty_tier VARCHAR);
CREATE TABLE orders (order_id BIGINT, customer_id BIGINT, shipping_address VARCHAR, ship_zip VARCHAR, card_number VARCHAR, order_total DECIMAL(10,2), created_at TIMESTAMP);
CREATE TABLE web_events (event_id VARCHAR, cookie_id VARCHAR, ip VARCHAR, lat DOUBLE, lon DOUBLE, page_path VARCHAR, user_agent VARCHAR);
