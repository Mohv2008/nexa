# NEXA Android shell

This is a thin Capacitor wrapper around `apps/web`; it contains no duplicate UI source.

```bash
npm run sync --workspace=@nexa/android
cd apps/android/android
./gradlew assembleDebug
```

Release signing is read from the `NEXA_KEYSTORE_*` environment variables configured by CI. See
`docs/BUILDING.md`; never commit `google-services.json` or a signing keystore.
