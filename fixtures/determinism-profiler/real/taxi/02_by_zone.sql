CREATE TABLE by_zone AS
SELECT z.Zone AS zone, count(*) AS trips, avg(t.fare_amount) AS avg_fare, sum(t.total_amount) AS revenue
FROM trips t JOIN read_csv('data/taxiZones.csv') z ON z.LocationID = t.PULocationID
GROUP BY z.Zone;
