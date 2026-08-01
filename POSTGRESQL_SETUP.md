# PostgreSQL Setup Guide for Careless

## What is PostgreSQL?

PostgreSQL is a database server — think of it as a filing cabinet where Careless stores:
- User accounts (patients, nurses, doctors)
- Care needs posted by patients
- Messages between users
- Payment records (the "Gate")
- Reviews and ratings

## Port 5342 vs 5432

| Port | Status | What to do |
|------|--------|-----------|
| **5432** | Default PostgreSQL port | Use this unless you have a conflict |
| **5342** | Custom port (your choice) | Totally fine! Just tell Node.js about it |

**5342 is perfectly valid.** Any port between 1024-65535 works.

## How to Set PostgreSQL to Port 5342

### Windows

1. Find `postgresql.conf`:
   ```
   C:\Program Files\PostgreSQL\data\postgresql.conf
   ```

2. Open it in Notepad/VS Code, find this line:
   ```
   #port = 5432
   ```

3. Change to:
   ```
   port = 5342
   ```

4. Restart PostgreSQL service:
   - Win+R → `services.msc`
   - Find "PostgreSQL" → Right-click → Restart

### macOS (Homebrew)

```bash
# Edit config
nano /opt/homebrew/var/postgresql@15/postgresql.conf

# Find port line, change to:
port = 5342

# Restart
brew services restart postgresql@15
```

### Ubuntu

```bash
# Edit config
sudo nano /etc/postgresql/15/main/postgresql.conf

# Find port line, change to:
port = 5342

# Restart
sudo systemctl restart postgresql
```

## Then Update Careless `.env`

In `server/.env`, change:
```
DB_PORT=5342
```

That's it. Node.js will now connect to PostgreSQL on port 5342.

## Verify It Works

```bash
# Test connection (will ask for password)
psql -U careless_admin -d careless -p 5342 -c "SELECT NOW();"

# Should show current timestamp
```

## Quick Commands Cheat Sheet

```bash
# Start PostgreSQL
sudo service postgresql start        # Linux
brew services start postgresql@15    # macOS
net start postgresql-x64-15          # Windows (admin CMD)

# Stop PostgreSQL
sudo service postgresql stop
brew services stop postgresql@15
net stop postgresql-x64-15

# Create database
psql -U postgres -p 5342 -c "CREATE DATABASE careless;"

# Create user
psql -U postgres -p 5342 -c "CREATE USER careless_admin WITH ENCRYPTED PASSWORD 'your_password';"

# Grant privileges
psql -U postgres -p 5342 -c "GRANT ALL PRIVILEGES ON DATABASE careless TO careless_admin;"

# Run schema
psql -U careless_admin -d careless -p 5342 -f database/schema.sql
```

## Troubleshooting

| Error | Fix |
|-------|-----|
| "Connection refused" | PostgreSQL not running, or wrong port |
| "password authentication failed" | Wrong password in `.env` |
| "database does not exist" | Run `CREATE DATABASE careless` |
| "role does not exist" | Run `CREATE USER careless_admin` |
| "port already in use" | Pick a different port (e.g. 5343) |
