export function Footer() {
  return (
    <footer className="border-t mt-auto">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col items-center justify-center gap-4 text-center">
          <div className="text-sm text-muted-foreground">
            <p className="font-semibold mb-2">SubScout © 2024</p>
            <p className="max-w-2xl">
              We do not store any information about your email content. We just
              scan it, classify it, and use it to create reminders if needed.
              Your privacy is our priority.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
