// Prints the names of the environment variables this process was started with, as JSON (#470):
// a test runs it as a project command to check what the engine passes. Never prints a value.
process.stdout.write(JSON.stringify(Object.keys(process.env)));
