<script lang="ts">
  import LegalPage from '../../../lib/components/LegalPage.svelte';
</script>

<svelte:head><title>Privacy policy · NEXA</title></svelte:head>
<LegalPage title="Privacy policy" updated="November 11, 2026">
  <h2>What NEXA collects</h2>
  <p>
    NEXA stores the account, profile, community membership, posts, messages, and files you choose to
    provide. Security logs use short-lived pseudonymous IP hashes; logs must not contain passwords,
    tokens, message bodies, or private profile data.
  </p>
  <h2>Why data is used</h2>
  <p>
    Data is processed only to authenticate you, deliver requested social and messaging features,
    prevent abuse, send notifications you enable, and operate the service. NEXA has no advertising
    SDKs or third-party analytics trackers.
  </p>
  <h2>Files and communications</h2>
  <p>
    Transport is encrypted with HTTPS and WSS. Direct messages are protected in transit but are <strong
      >not end-to-end encrypted in this release</strong
    >. Do not use NEXA for secrets requiring E2EE. An audited E2EE design is on the roadmap.
  </p>
  <h2>Retention and control</h2>
  <p>
    You can export your data from Settings → Privacy and delete your account from Settings → About.
    Account deletion cascades through authored content and removes uploaded objects. Operators
    should retain only minimal security logs and published legal obligations may require limited
    exceptions.
  </p>
  <h2>Processors</h2>
  <p>
    A default deployment uses Cloudflare for compute, database, and object storage; Resend may
    deliver account email; and Firebase Cloud Messaging may deliver Android push notifications.
    Deployers must publish their own configured processor list and contact details.
  </p>
  <h2>Children</h2>
  <p>
    NEXA requires users to be at least 13. A deployer may require a higher age where local law
    applies.
  </p>
  <h2>Contact</h2>
  <p>
    Replace <code>privacy@example.com</code> with the operator’s real privacy contact before launch.
  </p>
</LegalPage>
