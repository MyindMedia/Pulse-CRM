/* Pulse theming for ALL Clerk UI (applied on ClerkProvider, so sign-in,
   sign-up, the user button, org switcher, and any Clerk modal inherit it).
   Dark "studio" surface + Pulse gold. */
export const clerkAppearance = {
  variables: {
    colorBackground: "#141417",
    colorInputBackground: "#0d0d10",
    colorText: "#f6f6f5",
    colorTextSecondary: "#a3a3ad",
    colorInputText: "#f6f6f5",
    colorPrimary: "#fdb913",
    colorDanger: "#ff5d5d",
    colorSuccess: "#3ddc91",
    colorShimmer: "#fdb913",
    borderRadius: "10px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontFamilyButtons: "var(--font-inter), system-ui, sans-serif",
  },
  elements: {
    card: "bg-coal border border-hairline-2 shadow-pop",
    cardBox: "shadow-none",
    rootBox: "text-bone",
    // We render the Pulse logo above the card ourselves - hide Clerk's logo box.
    logoBox: "hidden",
    headerTitle: "font-display text-bone tracking-tight",
    headerSubtitle: "text-ash",
    socialButtonsBlockButton:
      "border border-hairline-2 bg-coal/60 text-bone transition-colors hover:border-gold-dim hover:bg-coal-2/70",
    socialButtonsBlockButtonText: "text-bone",
    dividerLine: "bg-hairline-2",
    dividerText: "text-ash-dim",
    formFieldLabel: "text-ash",
    formFieldInput:
      "bg-ink-2 border border-hairline-2 text-bone transition-colors focus:border-gold-dim focus:ring-gold-dim/30",
    formFieldInputShowPasswordButton: "text-ash-dim hover:text-bone",
    otpCodeFieldInput: "bg-ink-2 border border-hairline-2 text-bone focus:border-gold-dim",
    formButtonPrimary:
      "bg-gold text-gold-ink font-semibold transition-colors hover:bg-gold-bright shadow-none normal-case",
    formButtonReset: "text-ash hover:text-bone",
    formResendCodeLink: "text-gold hover:text-gold-bright",
    footerActionText: "text-ash",
    footerActionLink: "text-gold hover:text-gold-bright",
    footer: "bg-transparent",
    identityPreviewText: "text-bone",
    identityPreviewEditButton: "text-gold",
    formFieldErrorText: "text-critical",
    alertText: "text-ash",
    badge: "bg-gold/10 text-gold",
    // Clerk branding ("Secured by Clerk" / dev badge): hidden here, but note
    // that legitimately removing it requires Clerk's paid plan toggle (see
    // CLERK-SETUP.md). On the dev instance this CSS hide is best-effort only.
    logoImage: "hidden",
    // User button + org switcher popovers
    userButtonPopoverCard: "bg-coal border border-hairline-2 shadow-pop",
    userButtonPopoverActionButton: "text-ash hover:text-bone hover:bg-ink-2",
    userButtonPopoverFooter: "hidden",
    organizationSwitcherPopoverCard: "bg-coal border border-hairline-2 shadow-pop",
    organizationSwitcherTrigger: "text-bone hover:bg-ink-2",
    organizationPreviewMainIdentifier: "text-bone",
    // Modal chrome
    modalContent: "bg-coal",
    modalCloseButton: "text-ash hover:text-bone",
  },
} as const;
