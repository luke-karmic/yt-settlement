-- Create additional databases
CREATE DATABASE yeet_test;
CREATE DATABASE yeet_load;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE yeet_dev TO yeet;
GRANT ALL PRIVILEGES ON DATABASE yeet_test TO yeet;
GRANT ALL PRIVILEGES ON DATABASE yeet_load TO yeet;
