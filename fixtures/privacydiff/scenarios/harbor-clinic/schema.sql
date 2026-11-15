-- Harbor Clinic patient records
CREATE TABLE patients (
  patient_id BIGINT PRIMARY KEY,
  name VARCHAR,
  dob DATE,
  email VARCHAR,
  phone VARCHAR,
  ssn VARCHAR,
  insurance_id VARCHAR,
  zip_code VARCHAR(10),
  registered_on DATE
);
CREATE TABLE visits (
  visit_id BIGINT,
  patient_id BIGINT,
  diagnosis VARCHAR,
  medications VARCHAR,
  treatment_plan VARCHAR,
  clinic_id INTEGER,
  billing_code VARCHAR
);
