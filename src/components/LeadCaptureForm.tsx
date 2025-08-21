import { useState, useEffect, useCallback, useMemo } from "react";
import { Mail, User, CheckCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { validateLeadForm, ValidationError } from "@/lib/validation";
import { supabase } from "@/integrations/supabase/client";
import { useLeadStore } from "@/lib/lead-store";
import { useToast } from "@/hooks/use-toast";

// GLOBAL SINGLETON to prevent duplicate API calls
class EmailSubmissionManager {
  private static instance: EmailSubmissionManager;
  private apiCallInProgress = false;
  private processedRequests = new Set<string>();
  private lastSubmissionTime = 0;

  static getInstance(): EmailSubmissionManager {
    if (!EmailSubmissionManager.instance) {
      EmailSubmissionManager.instance = new EmailSubmissionManager();
    }
    return EmailSubmissionManager.instance;
  }

  canSubmit(requestId: string): boolean {
    const now = Date.now();

    if (this.apiCallInProgress) {
      console.log("🛑 GLOBAL: API call already in progress");
      return false;
    }

    if (this.processedRequests.has(requestId)) {
      console.log(`🛑 GLOBAL: Request ${requestId} already processed`);
      return false;
    }

    if (now - this.lastSubmissionTime < 3000) {
      console.log("🛑 GLOBAL: Too soon since last submission");
      return false;
    }

    return true;
  }

  startSubmission(requestId: string): void {
    this.apiCallInProgress = true;
    this.processedRequests.add(requestId);
    this.lastSubmissionTime = Date.now();
    console.log(`🔒 GLOBAL: Started submission ${requestId}`);
  }

  endSubmission(requestId: string): void {
    this.apiCallInProgress = false;
    console.log(`🔓 GLOBAL: Ended submission ${requestId}`);
  }

  reset(): void {
    this.apiCallInProgress = false;
    this.processedRequests.clear();
    this.lastSubmissionTime = 0;
    console.log("🔄 GLOBAL: Reset all submission data");
  }

  get isApiCallInProgress(): boolean {
    return this.apiCallInProgress;
  }
}

const emailManager = EmailSubmissionManager.getInstance();

export const LeadCaptureForm = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    industry: "",
  });
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>(
    []
  );
  const [submitted, setSubmitted] = useState(false);
  const [leads, setLeads] = useState<
    Array<{
      name: string;
      email: string;
      industry: string;
      submitted_at: string;
    }>
  >([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { toast } = useToast();
  const { addLead, setSubmitted: setStoreSubmitted } = useLeadStore();

  // ✅ FIXED: Added emailManager.reset() to useEffect
  useEffect(() => {
    setSubmitted(false);
    emailManager.reset(); // CRITICAL FIX: Reset global manager on mount
  }, []);

  const getFieldError = useCallback(
    (field: string) => {
      return validationErrors.find((error) => error.field === field)?.message;
    },
    [validationErrors]
  );

  const generateRequestId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const handleInputChange = useCallback(
    (field: string, value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
      if (validationErrors.some((error) => error.field === field)) {
        setValidationErrors((prev) =>
          prev.filter((error) => error.field !== field)
        );
      }
    },
    [validationErrors]
  );

  // ✅ FIXED: Added proper dependency to handleEmailChange
  const handleEmailChange = useCallback(
    (email: string) => {
      handleInputChange("email", email);
    },
    [handleInputChange]
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();

      // Validate form
      const errors = validateLeadForm(formData);
      setValidationErrors(errors);

      if (errors.length > 0) {
        return;
      }

      // Generate unique request ID
      const requestId = generateRequestId();

      // ✅ FIXED: Use global manager to prevent duplicates
      if (!emailManager.canSubmit(requestId)) {
        console.log(`🛑 GLOBAL MANAGER: Submission blocked for ${requestId}`);
        return;
      }

      setIsSubmitting(true);
      emailManager.startSubmission(requestId);

      try {
        // Small delay to prevent React Strict Mode double execution
        await new Promise((resolve) => setTimeout(resolve, 100));

        console.log(`🚀 Starting form submission... Request ID: ${requestId}`);

        const normalizedEmail = formData.email.toLowerCase().trim();

        // Send confirmation email
        console.log(
          `📧 Sending confirmation email... Request ID: ${requestId}`
        );

        const emailResult = await supabase.functions.invoke(
          "send-confirmation",
          {
            body: {
              name: formData.name,
              email: normalizedEmail,
              industry: formData.industry,
              requestId: requestId,
            },
          }
        );

        if (emailResult.error) {
          console.error(
            "❌ Error sending confirmation email:",
            emailResult.error
          );
          toast({
            title: "Email Error",
            description: `Failed to send confirmation email: ${emailResult.error.message}`,
            variant: "destructive",
          });
          return;
        }

        console.log(
          `✅ Confirmation email sent successfully for Request ID: ${requestId}`
        );
        toast({
          title: "Email Sent!",
          description: "Confirmation email sent successfully!",
        });

        // Save to database - allow duplicate emails
        console.log("💾 Saving lead to database...");

        const leadData = {
          name: formData.name,
          email: normalizedEmail,
          industry: formData.industry,
          submitted_at: new Date().toISOString(),
        };

        const { error: dbError } = await supabase
          .from("leads")
          .insert([leadData]);

        if (dbError) {
          console.error("❌ Error saving to database:", dbError);

          // Handle database errors but allow duplicate emails
          if (dbError.code === "23505") {
            console.log(
              "ℹ️ Duplicate email constraint - continuing with success flow"
            );
          } else {
            toast({
              title: "Database Error",
              description: `Failed to save lead: ${dbError.message}`,
              variant: "destructive",
            });
            return;
          }
        } else {
          console.log("✅ Lead saved to database successfully");
        }

        // Update state and show success
        const lead = {
          name: formData.name,
          email: normalizedEmail,
          industry: formData.industry,
          submitted_at: new Date().toISOString(),
        };

        setLeads([...leads, lead]);
        addLead(lead);
        setStoreSubmitted(true);
        setSubmitted(true);
        setFormData({ name: "", email: "", industry: "" });

        console.log(
          `🎉 Form submission completed successfully for Request ID: ${requestId}`
        );

        toast({
          title: "Welcome aboard! 🎉",
          description: "You've successfully joined our community!",
        });
      } catch (error) {
        console.error("❌ Error in form submission:", error);
        toast({
          title: "Submission Error",
          description: "Failed to submit lead. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSubmitting(false);
        emailManager.endSubmission(requestId);
        console.log("🔄 Form submission process completed");
      }
    },
    [formData, leads, addLead, setStoreSubmitted, toast, generateRequestId]
  );

  const resetForm = useCallback(() => {
    console.log("🔄 Resetting form and all guards...");
    setSubmitted(false);
    setStoreSubmitted(false);
    setFormData({ name: "", email: "", industry: "" });
    setValidationErrors([]);
    emailManager.reset();
    console.log("✅ Form reset completed");
  }, [setStoreSubmitted]);

  // ✅ PERFORMANCE: Memoize industry options
  const industryOptions = useMemo(
    () => [
      { value: "technology", label: "Technology" },
      { value: "healthcare", label: "Healthcare" },
      { value: "finance", label: "Finance" },
      { value: "education", label: "Education" },
      { value: "retail", label: "Retail & E-commerce" },
      { value: "manufacturing", label: "Manufacturing" },
      { value: "consulting", label: "Consulting" },
      { value: "other", label: "Other" },
    ],
    []
  );

  if (submitted) {
    return (
      <div className="w-full max-w-md mx-auto">
        <div className="bg-gradient-card p-8 rounded-2xl shadow-card border border-border backdrop-blur-sm animate-slide-up text-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-gradient-primary rounded-full flex items-center justify-center mx-auto shadow-glow animate-glow">
              <CheckCircle className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-foreground mb-3">
            Welcome aboard! 🎉
          </h2>

          <p className="text-muted-foreground mb-2">
            Thanks for joining! We'll be in touch soon with updates.
          </p>

          <p className="text-sm text-accent mb-8">
            You're #{leads.length} in this session
          </p>

          <div className="space-y-4">
            <div className="p-4 bg-accent/10 rounded-lg border border-accent/20">
              <p className="text-sm text-foreground">
                💡 <strong>What's next?</strong>
                <br />
                We'll send you exclusive updates, early access, and
                behind-the-scenes content as we build something amazing.
              </p>
            </div>

            <Button
              onClick={resetForm}
              variant="outline"
              className="w-full border-border hover:bg-accent/10 transition-smooth group"
            >
              Submit Another Lead
              <User className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
          </div>

          <div className="mt-6 pt-6 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Follow our journey on social media for real-time updates
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-gradient-card p-8 rounded-2xl shadow-card border border-border backdrop-blur-sm animate-slide-up">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-4 shadow-glow">
            <Mail className="w-8 h-8 text-primary-foreground" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Join Our Community
          </h2>
          <p className="text-muted-foreground">
            Be the first to know when we launch
          </p>
        </div>

        {/* ✅ FIXED: Form onSubmit now checks global manager */}
        <form
          onSubmit={(e) => {
            if (emailManager.isApiCallInProgress) {
              e.preventDefault();
              console.log("🛑 Form submission blocked by global manager");
              return;
            }
            handleSubmit(e);
          }}
          className="space-y-6"
        >
          <div className="space-y-2">
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Your name"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                className={`pl-10 h-12 bg-input border-border text-foreground placeholder:text-muted-foreground transition-smooth
                  ${
                    getFieldError("name")
                      ? "border-destructive"
                      : "focus:border-accent focus:shadow-glow"
                  }
                `}
              />
            </div>
            {getFieldError("name") && (
              <p className="text-destructive text-sm animate-fade-in">
                {getFieldError("name")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                type="email"
                placeholder="your@email.com"
                value={formData.email}
                onChange={(e) => handleEmailChange(e.target.value)}
                className={`pl-10 h-12 bg-input border-border text-foreground placeholder:text-muted-foreground transition-smooth
                  ${
                    getFieldError("email")
                      ? "border-destructive"
                      : "focus:border-accent focus:shadow-glow"
                  }
                `}
              />
            </div>
            {getFieldError("email") && (
              <p className="text-sm animate-fade-in text-destructive">
                {getFieldError("email")}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground z-10" />
              <Select
                value={formData.industry}
                onValueChange={(value) => handleInputChange("industry", value)}
              >
                <SelectTrigger
                  className={`pl-10 h-12 bg-input border-border text-foreground transition-smooth
                  ${
                    getFieldError("industry")
                      ? "border-destructive"
                      : "focus:border-accent focus:shadow-glow"
                  }
                `}
                >
                  <SelectValue placeholder="Select your industry" />
                </SelectTrigger>
                <SelectContent>
                  {industryOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {getFieldError("industry") && (
              <p className="text-sm animate-fade-in text-destructive">
                {getFieldError("industry")}
              </p>
            )}
          </div>

          {/* ✅ FIXED: Button disabled state now uses global manager */}
          <Button
            type="submit"
            disabled={isSubmitting || emailManager.isApiCallInProgress}
            className="w-full h-12 bg-gradient-primary text-primary-foreground font-semibold rounded-lg shadow-glow hover:shadow-[0_0_60px_hsl(210_100%_60%/0.3)] transition-smooth transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Sending...
              </div>
            ) : (
              <>
                <CheckCircle className="w-5 h-5 mr-2" />
                Get Early Access
              </>
            )}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center mt-6">
          By submitting, you agree to receive updates. Unsubscribe anytime.
        </p>
      </div>
    </div>
  );
};
