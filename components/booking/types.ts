/** Already-localised catalogue the server hands the wizard. */
export type PublicService = { id: string; name: string; description: string | null; durationMinutes: number; priceLabel: string };
export type PublicDentist = { id: string; name: string; title: string | null; serviceIds: string[] };
export type PublicClinicInfo = { slug: string; name: string; timeZone: string; horizonDays: number };
