-- The tag list comes out in whatever order the rows arrived.
SELECT string_agg(tag, ',') AS tags
FROM (SELECT DISTINCT tag FROM arrivals);
