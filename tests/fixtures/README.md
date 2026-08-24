# Local image fixtures

Place test images in `images/` and register their expected counts in `images/manifest.json`:

```json
{
  "images": [
    {
      "file": "reference-a.jpg",
      "expected_count": 123
    }
  ]
}
```

Each `file` path is relative to `images/`. The local fixture test is skipped when the manifest is absent.
