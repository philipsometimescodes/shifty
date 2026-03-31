type EmailMessage = {
  to: string;
  subject: string;
  body: string;
};

export async function sendEmail(message: EmailMessage) {
  console.log("\n--- Shifty Email ---");
  console.log(`To: ${message.to}`);
  console.log(`Subject: ${message.subject}`);
  console.log(message.body);
  console.log("--- End Email ---\n");
}