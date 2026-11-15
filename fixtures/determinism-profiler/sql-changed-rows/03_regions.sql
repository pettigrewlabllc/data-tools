-- No column here is unique, so there's no key to list rows by.
CREATE TABLE regions AS
SELECT region, round(random() * 10) AS bucket FROM customers;
