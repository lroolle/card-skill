;; lint.el -- run Org's own linter on each file named on the command line.
;; One line per file, then one line per finding. Used by test/emacs.test.mjs.
(require 'org)
(require 'org-lint)
(setq org-element-use-cache nil)
(dolist (file command-line-args-left)
  (with-temp-buffer
    (insert-file-contents file)
    (let ((buffer-file-name file))
      (org-mode)
      (let ((found (org-lint)))
        (princ (format "FILE\t%s\t%d\n" file (length found)))
        (dolist (f found)
          (let ((v (cadr f)))
            (princ (format "FINDING\t%s\t%s\t%s\n" file (aref v 0) (aref v 2)))))))))
