# Contributing Guide

First off, thanks for taking the time to contribute! 🎉

This project is open to contributions of all kinds: code, documentation, examples, bug reports, feature suggestions, and more.

---

## 🚀 How to Contribute

### 1. Fork the repo

Click the "Fork" button at the top of the repo, then clone your fork:

```bash
git clone https://github.com/monorist/monorise.git
cd monorise
```

### 2. Create a new branch

Use a clear and descriptive name:

```bash
git checkout -b fix/typo-in-readme
```

### 3. Make your changes

Follow existing code style and naming conventions. Run lint and tests before committing.

### 4. Commit your changes with changesets

Write clear, concise commit messages:

For changeset, select the impacted packages with ideal semantic versioning.

```bash
npm run changeset
git add .
git commit -m "fix: corrected typo in README"
```

### 5. Push and create a pull request

```bash
git push origin your-branch-name
```

Then open a pull request from your fork on GitHub. Make sure to:

- Describe what your PR does
- Reference any related issues (`Closes #123`)
- Include screenshots or examples if applicable

---

## ✅ Guidelines

- Keep PRs focused and small when possible.
- Use clear and consistent naming.
- Document any new features or changes.
- Write or update tests for any logic changes.
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md).

---

## 🧪 Running the Project Locally

```bash
npm install
npm run dev
```

To run tests:

```bash
npm test
```

---

## 🤝 Need Help?

Feel free to join our [Discord](https://discord.gg/9c3ccQkvGj) for discussion or create an issue if you’re stuck!

Thanks again! You’re awesome. 💙
```
