CREATE VIEW trips AS SELECT * FROM read_parquet('data/taxiTrips.parquet');
