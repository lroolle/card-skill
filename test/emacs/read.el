;; read.el -- print each card of a board as Emacs reads it: one tab-separated
;; line per second-level heading. Used by test/emacs.test.mjs to check that
;; Org and our parser see the same cards.
(require 'org)
(dolist (file command-line-args-left)
  (with-temp-buffer
    (insert-file-contents file)
    (org-mode)
    (org-map-entries
     (lambda ()
       (when (= (org-current-level) 2)
         (princ (format "CARD\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n"
                        file
                        (or (org-get-todo-state) "")
                        (or (org-entry-get nil "CUSTOM_ID") "")
                        (or (org-entry-get nil "ASK") "")
                        (or (org-entry-get nil "NEEDS") "")
                        (mapconcat #'identity (org-get-tags nil t) ",")
                        (org-get-heading t t t t))))))))
