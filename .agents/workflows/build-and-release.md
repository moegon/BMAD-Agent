# BMAD Agent — Build and Release Workflow

## Steps

1. Install dependencies:
   ```bash
   npm install
   ```

2. Compile TypeScript and copy resources:
   ```bash
   npm run compile
   ```

3. Run linting:
   ```bash
   npm run lint
   ```

4. Run tests:
   ```bash
   npm run test
   ```

5. Run smoke checks:
   ```bash
   npm run smoke
   npm run smoke:lmstudio
   ```

6. Package the extension:
   ```bash
   npx vsce package --no-dependencies
   ```

7. Verify the `.vsix` file was generated.

## Notes

- The `compile` script runs both `tsc -p .` and `npm run copy:resources`.
- Resources are copied from `src/resources/` to `dist/resources/`.
- The main entry point is `dist/extension.js`.
- In containerised environments, set `ELECTRON_DISABLE_SANDBOX=1` for tests.
