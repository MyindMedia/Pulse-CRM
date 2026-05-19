/* Dark "Brutalist Studio" theming for Clerk's hosted auth components. */
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
    borderRadius: "10px",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
  },
  elements: {
    card: "bg-coal border border-hairline-2 shadow-pop",
    headerTitle: "font-display",
    formButtonPrimary: "bg-gold text-gold-ink hover:bg-gold-bright",
    footerActionLink: "text-gold hover:text-gold-bright",
  },
} as const;
