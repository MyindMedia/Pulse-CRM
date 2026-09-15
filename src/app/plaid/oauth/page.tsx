export const metadata = { title: "Return to Pulse" };

export default function PlaidOAuthPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">Return to Pulse</h1>
      <p className="text-muted-foreground">
        Open the Pulse app to finish connecting your bank. If the app closed during
        bank sign-in, return to Integrations and start the connection again.
      </p>
    </main>
  );
}
