/**
 * Customer Pay story templates — pre-written narratives for non-warranty work.
 *
 * Compliance: Customer Pay repairs do not require Merlin AI generation, MI 2.0
 * quality scoring, or warranty-grade audit promptVersion tracking. Applying these
 * templates bypasses Grok entirely and writes a lightweight audit entry instead.
 */

export type TemplateTypeLabel = 'Warranty' | 'CustomerPay';

export interface CustomerPayTemplate {
  title: string;
  description: string;
  preWrittenStory: string;
}

export const CUSTOMER_PAY_TEMPLATES: CustomerPayTemplate[] = [
  {
    title: 'Front Brake Job',
    description: 'Complete front brake rotor and pad replacement with hardware service.',
    preWrittenStory:
      'Performed a complete front brake service. Removed and replaced both brake rotors and brake pads. Installed new brake pad wear sensors. Thoroughly cleaned and lubricated all caliper slide pins and hardware. Reassembled using new brake hardware. Conducted a post-service test drive to properly bed in the new brakes and verify smooth operation.',
  },
  {
    title: 'Rear Brake Job',
    description: 'Complete rear brake rotor and pad replacement with hardware service.',
    preWrittenStory:
      'Performed a complete rear brake service. Removed and replaced both brake rotors and brake pads. Installed new brake pad wear sensors. Thoroughly cleaned and lubricated all caliper slide pins and hardware. Reassembled using new brake hardware. Conducted a post-service test drive to properly bed in the new brakes and verify smooth operation.',
  },
  {
    title: 'Mercedes-Benz Brake Fluid Flush',
    description: 'Four-wheel brake fluid exchange using genuine Mercedes-Benz fluid.',
    preWrittenStory:
      'Performed a complete four-wheel brake fluid service using genuine Mercedes-Benz brake fluid. Flushed all four brake calipers and lines. Bled the brake system thoroughly to remove all old fluid and air. Refilled and bled the system with fresh Mercedes-Benz brake fluid to manufacturer specifications. Verified proper brake pedal feel and function.',
  },
  {
    title: 'Standard Brake Fluid Flush',
    description: 'Four-wheel brake fluid exchange with high-quality replacement fluid.',
    preWrittenStory:
      'Performed a complete four-wheel brake fluid service. Flushed all four brake calipers and brake lines. Thoroughly bled the system to remove old contaminated fluid and air. Refilled with new high-quality brake fluid and performed a final bleed to ensure proper system operation and firm brake pedal feel.',
  },
  {
    title: 'Spark Plug Replacement',
    description: 'Full spark plug replacement with coil service and Xentry reset.',
    preWrittenStory:
      'Performed a complete spark plug replacement service. Removed and replaced all spark plugs with new OEM-specification plugs, torqued to manufacturer specifications. Applied dielectric grease to all ignition coil boots prior to reinstallation. Reinstalled ignition coils and all removed hardware. Connected a battery maintainer and used Xentry to clear any stored codes, reset adaptations, and save all learned values.',
  },
  {
    title: 'Engine Air Filter Replacement',
    description: 'Engine air filter element replacement and housing inspection.',
    preWrittenStory:
      'Performed engine air filter replacement service. Removed and replaced the engine air filter element(s) with new genuine filter media. Inspected the air filter housing and cleaned out any debris. Properly seated the new filter(s) and securely reassembled the air filter housing. Verified all clamps and seals are properly fastened for optimal engine performance and filtration.',
  },
  {
    title: 'Rear Wiper Arm Replacement',
    description: 'Rear wiper arm replacement due to corrosion or seized pivot.',
    preWrittenStory:
      'Performed rear wiper arm replacement. Removed the damaged rear wiper arm, which had seized and cracked at the motor pivot due to corrosion. Installed a new rear wiper arm, properly aligned and torqued the retaining nut to specification. Verified smooth and correct operation of the rear wiper across the full range of motion. Tested both intermittent and high-speed settings to ensure proper function.',
  },
  {
    title: 'Rear Differential Fluid Change',
    description: 'Rear differential gear oil drain and fill service.',
    preWrittenStory:
      'Performed rear differential fluid service. Raised the vehicle on a lift and removed the rear differential fill and drain plugs. Drained the old differential fluid completely. Reinstalled the drain plug with a new crush washer and filled the differential with new manufacturer-specified gear oil to the correct level. Verified no leaks and properly reinstalled the fill plug.',
  },
  {
    title: 'Front Differential Fluid Change',
    description: 'Front differential gear oil drain and fill service.',
    preWrittenStory:
      'Performed front differential fluid service. Raised the vehicle on a lift and removed the front differential fill and drain plugs. Completely drained the old fluid. Reinstalled the drain plug with a new crush washer and filled the differential with new manufacturer-specified gear oil to the correct level. Verified no leaks and properly reinstalled the fill plug.',
  },
  {
    title: '12-Volt Main Battery Replacement',
    description: 'Main 12-volt battery replacement with Xentry registration.',
    preWrittenStory:
      'Performed 12-volt main battery replacement. Customer reported multiple electrical warnings and "Consumer Items Offline" message. Conducted a battery load test which confirmed the main battery had failed. Replaced the main 12-volt battery with a new unit. Performed battery registration using Xentry and cleared all related fault codes. Verified proper system voltage and operation of all electrical systems.',
  },
  {
    title: 'Auxiliary Battery Replacement',
    description: 'Auxiliary battery replacement with Xentry registration.',
    preWrittenStory:
      'Performed auxiliary battery replacement. Customer reported "Consumer Items Offline" warning message. Diagnosed and confirmed the auxiliary battery had failed. Replaced the auxiliary battery with a new unit. Performed battery registration using Xentry and cleared all related fault codes. Verified proper charging and operation of all auxiliary electrical systems.',
  },
  {
    title: 'Transmission Service',
    description: 'Transmission fluid and filter service with Xentry level check.',
    preWrittenStory:
      'Performed transmission service. Drained the old transmission fluid and replaced the internal filter. Refilled with new Mercedes-Benz approved transmission fluid. Connected Xentry and used the ultrasonic sensor to check and set the transmission fluid to the correct level at operating temperature. Performed a transmission adaptation reset and test drove the vehicle to verify smooth shifting and proper operation.',
  },
];

export function isCustomerPayTemplateType(templateType: string | null | undefined): boolean {
  return templateType === 'CustomerPay';
}

export function templateRowIsCustomerPay(row: {
  isCustomerPay: boolean;
  templateType?: string;
  category?: string;
}): boolean {
  return row.isCustomerPay === true;
}