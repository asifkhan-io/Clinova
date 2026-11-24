// The <html> element lives in app/[locale]/layout.tsx, because `lang` and `dir`
// depend on the locale. This root layout only passes children through.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return children;
}
