import { Profile } from "./types";

// Seeds the Profile form so the demo works immediately, matching
// lib/masterCV.ts's DEFAULT_MASTER_CV. Replace with your own details —
// this is what fills the header of every generated CV/cover letter.
export const DEFAULT_PROFILE: Profile = {
  name: "Muhammad Mustafa",
  title: "Senior Full-Stack Engineer",
  location: "Karachi, Pakistan",
  email: "mustufa50@gmail.com",
  phone: "",
  links: ["mustcode.netlify.app", "linkedin.com/in/muhammad-mustafa-16477a99"],
};
