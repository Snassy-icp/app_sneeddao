import React, { useState, useEffect } from 'react';

function ConfirmationModal({ show, onClose, onSubmit, message, doAwait }) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    if (show) {
        setErrorText('');
    }
  }, [show]);

  const handleSubmit = async () => {
    setErrorText('');
    
    try {
      setIsLoading(true);
      setErrorText("");
      if (doAwait) {
        await onSubmit();
      } else {
        onSubmit();
      }
    } catch (error) {
      setErrorText("Error: " + error);
    }
    finally {
      setIsLoading(false);
      onClose();
    }
  };

  if (!show) {
    return null;
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <h2>Are you sure?</h2>
        <p>{message}</p>
        {errorText && <p className="error-text">{errorText}</p>}
        {isLoading ? (
            <div>
                <br />
                <div className="spinner"></div>
            </div>
        ) : (
          <div className="button-group">
            <button onClick={handleSubmit}>Ok</button>
            <button onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfirmationModal;