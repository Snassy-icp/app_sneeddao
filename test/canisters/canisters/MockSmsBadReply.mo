/// Stands in for Sneed SMS in the sneed_notifications tests: `send_system_notification` answers
/// with a type the caller cannot decode, so the caller traps after its await (the delivery
/// timer's `ticking` flag must still be cleared).
persistent actor {
  public func send_system_notification(_ : { recipients : [Principal]; subject : Text; body : Text }) : async Text {
    "not the answer you expected";
  };
};
